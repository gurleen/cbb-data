import type { DataSource } from "./datasource";

export interface Env {
  DATA: R2Bucket;
  RATE_LIMITER?: RateLimit;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { data: DataSource };
};
