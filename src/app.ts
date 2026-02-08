import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { registerAdminRoutes } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerBotRoutes } from "./routes/bots";
import { registerDonationRoutes } from "./routes/donations";
import { registerHealthRoutes } from "./routes/health";
import { registerMatchRoutes } from "./routes/matches";
import { registerOpenApiRoutes } from "./routes/openapi";
import { registerPublicRoutes } from "./routes/public";
import { registerUiRoutes } from "./routes/ui";
import type { RuntimeEnv } from "./types/runtime";

export const buildApp = (env: RuntimeEnv): Elysia => {
	const app = new Elysia({
		adapter: CloudflareAdapter,
		// Cloudflare runtime blocks dynamic code generation.
		aot: false,
	});

	registerHealthRoutes(app);
	registerOpenApiRoutes(app);
	registerAuthRoutes(app, env);
	registerBotRoutes(app, env);
	registerMatchRoutes(app, env);
	registerPublicRoutes(app, env);
	registerDonationRoutes(app, env);
	registerAdminRoutes(app, env);
	registerUiRoutes(app);

	return app;
};
