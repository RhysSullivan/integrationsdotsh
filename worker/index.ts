export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  POSTHOG_KEY: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const country = request.headers.get("cf-ipcountry") || "unknown";
    const agent = request.headers.get("user-agent") || "unknown";
    if (agent.includes("executor")) {
      ctx.waitUntil(
        fetch("https://us.i.posthog.com/i/v0/e/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: env.POSTHOG_KEY,
            event: "hit",
            distinct_id: ip,
            properties: {
              $process_person_profile: false,
              user_agent: agent,
              country,
              path: url.pathname,
            },
          }),
        }),
      );
    }

    return await env.ASSETS.fetch(request);
  },
};
