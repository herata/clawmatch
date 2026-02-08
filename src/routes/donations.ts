import type { Elysia } from "elysia";
import {
	requireIdempotencyKey,
	runIdempotent,
} from "../middleware/idempotency";
import {
	createDonation,
	createDonationEvent,
	getDonationById,
	updateDonationStatus,
} from "../repos/donations";
import { hmacSha256Hex, secureEqual } from "../services/crypto";
import type { RuntimeEnv } from "../types/runtime";
import { nowIso } from "../utils/time";
import { asNumber, asString } from "../utils/validation";

type CheckoutBody = {
	match_id?: unknown;
	conversation_id?: unknown;
	amount_minor?: unknown;
	currency?: unknown;
	network?: unknown;
	payer_ref?: unknown;
};

export const registerDonationRoutes = (app: Elysia, env: RuntimeEnv): void => {
	app.post("/v1/donations/x402/checkout", async ({ request, body, status }) => {
		const idempotencyKey = requireIdempotencyKey(request);
		if (!idempotencyKey)
			return status(400, { ok: false, error: "idempotency_key_required" });

		const payload = (body ?? {}) as CheckoutBody;
		const amountMinor = asNumber(payload.amount_minor);
		const currency = asString(payload.currency) ?? "USDC";
		const network = asString(payload.network) ?? "base";
		const matchId = asString(payload.match_id);
		const conversationId = asString(payload.conversation_id);
		const payerRef = asString(payload.payer_ref);

		if (!amountMinor || amountMinor <= 0) {
			return status(400, { ok: false, error: "amount_minor_required" });
		}

		const paymentResponseHeader =
			request.headers.get("payment-response") ||
			request.headers.get("x-payment-response");

		const result = await runIdempotent(
			env.DB,
			`x402_checkout:${idempotencyKey}`,
			idempotencyKey,
			async () => {
				const donationId = crypto.randomUUID();
				await createDonation(env.DB, {
					id: donationId,
					matchId,
					conversationId,
					amountMinor,
					currency,
					network,
					payerRef,
					status: paymentResponseHeader ? "pending" : "initiated",
				});

				if (!paymentResponseHeader) {
					return {
						status: 402,
						body: {
							ok: false,
							error: "payment_required",
							donation_id: donationId,
							payment_required: {
								protocol: "x402",
								accepted_network: network,
								accepted_currency: currency,
								amount_minor: amountMinor,
							},
						},
					};
				}

				return {
					status: 200,
					body: {
						ok: true,
						donation_id: donationId,
						status: "pending",
					},
				};
			},
		);

		return status(result.status, {
			...result.body,
			replayed: result.replayed,
		});
	});

	app.post(
		"/v1/donations/x402/webhook",
		async ({ body, request, status }) => {
			if (!env.X402_WEBHOOK_SECRET) {
				return status(500, {
					ok: false,
					error: "x402_webhook_secret_not_configured",
				});
			}

			const signature =
				request.headers.get("x-x402-signature") ||
				request.headers.get("payment-signature");
			if (!signature) {
				return status(401, { ok: false, error: "signature_required" });
			}

			const raw = typeof body === "string" ? body : "";
			if (!raw) {
				return status(400, { ok: false, error: "raw_payload_required" });
			}

			const expected = await hmacSha256Hex(env.X402_WEBHOOK_SECRET, raw);
			if (!secureEqual(signature, expected)) {
				return status(401, { ok: false, error: "signature_invalid" });
			}

			let payload: {
				provider_event_id?: string;
				donation_id?: string;
				status?: "pending" | "confirmed" | "failed";
				settlement_ref?: string;
			};

			try {
				payload = JSON.parse(raw) as {
					provider_event_id?: string;
					donation_id?: string;
					status?: "pending" | "confirmed" | "failed";
					settlement_ref?: string;
				};
			} catch {
				return status(400, { ok: false, error: "invalid_json" });
			}

			const providerEventId = asString(payload.provider_event_id);
			const donationId = asString(payload.donation_id);
			const eventStatus = asString(payload.status) as
				| "pending"
				| "confirmed"
				| "failed"
				| null;

			if (!providerEventId)
				return status(400, { ok: false, error: "provider_event_id_required" });
			if (!donationId)
				return status(400, { ok: false, error: "donation_id_required" });
			if (
				!eventStatus ||
				!["pending", "confirmed", "failed"].includes(eventStatus)
			) {
				return status(400, { ok: false, error: "invalid_status" });
			}

			const donation = await getDonationById(env.DB, donationId);
			if (!donation) {
				return status(404, { ok: false, error: "donation_not_found" });
			}

			const event = await createDonationEvent(env.DB, {
				id: crypto.randomUUID(),
				donationId,
				providerEventId,
				payloadJson: raw,
			});

			if (!event.inserted) {
				return {
					ok: true,
					duplicate: true,
				};
			}

			await updateDonationStatus(env.DB, {
				id: donationId,
				status: eventStatus,
				settlementRef: asString(payload.settlement_ref),
				confirmedAt: eventStatus === "confirmed" ? nowIso() : null,
			});

			return {
				ok: true,
				donation_id: donationId,
				status: eventStatus,
			};
		},
		{
			parse: "text",
		},
	);
};
