declare namespace Cloudflare {
  interface Env {
    DATA: R2Bucket;
    RATE_LIMITER?: RateLimit;
  }
  interface GlobalProps {
    mainModule: typeof import("../src/index");
  }
}
