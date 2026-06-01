import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function createLoginRatelimit(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  return new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(5, "60 s"),
    prefix: "rl:login",
  });
}

export const loginRatelimit = createLoginRatelimit();
