import { env as cfEnv } from 'cloudflare:workers'
import type { RuntimeEnv } from '../types/runtime'

export const runtimeEnv = cfEnv as unknown as RuntimeEnv
