# Container image for the Cloudflare Sandbox provider.
#
# Only used when SANDBOX_PROVIDER is "cloudflare" and the `containers` block in
# wrangler.jsonc is enabled. The base image ships the agent that the Sandbox SDK
# talks to — keep its tag in step with the @cloudflare/sandbox version in
# package.json, or the SDK and the container can disagree about the protocol.
FROM docker.io/cloudflare/sandbox:0.12.4

# Required for local development: wrangler needs the port declared explicitly,
# whereas deployed containers expose every port.
EXPOSE 3000
