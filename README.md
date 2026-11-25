# Payment Gateway

A mobile-first, reusable payment gateway backed by a hosted checkout. Any website or mobile backend can create a payment request, redirect the customer to the returned checkout URL, query payment status, and receive a signed success notification.

The gateway supports two operating modes:

- **Mock mode**: safe integration testing with no HitPay account and no real money movement.
- **Live adapter mode**: creates real HitPay payment requests using protected HitPay credentials. Sandbox and Production are selected independently.

The gateway server keeps private credentials server-side. The browser never receives the HitPay API key, HitPay salt, gateway API key, or admin key.

## Project URLs

After the project is running, these routes are available:

| Route | Purpose |
| --- | --- |
| `/` | Mobile hosted checkout page |
| `/docs` | In-browser API documentation |
| `/admin` | Protected CMS administration dashboard |
| `/payment-result.html` | Customer return/status page |
| `/mock-checkout.html` | Mock-only test checkout |
| `/health` | Health check |
| `/_app/health` | Deployment health check |

## How the system works

A connected website calls the gateway from its own backend. The gateway validates the request and creates a payment request. In mock mode it returns an internal test checkout URL. In live mode it calls HitPay’s Payment Request API and returns HitPay’s hosted checkout URL. The connected backend redirects the customer to that URL.

After checkout, the customer is returned to the configured redirect URL. The redirect is only a user-experience signal and must not be treated as proof of payment. Payment confirmation comes from the signed HitPay webhook in live mode or from the mock completion flow in mock mode. The gateway can also send a custom signed `payment.succeeded` notification to the connected website.

The managed MySQL database stores CMS settings. Payment records in the current implementation are held in process memory; use the signed webhook and your own order database as the durable source of truth for business orders.

## CMS administration

Open `/admin` and enter the protected `ADMIN_API_KEY`. The key is stored in the browser session only and sent to the server as a Bearer token. It is not embedded in the checkout page.

The CMS controls:

- Brand name, tagline, headline, and checkout description
- Logo URL and support email
- Primary, accent, and background colors
- Checkout button text and success message
- Supported currencies and default currency
- Whether the payment-description field is shown
- Default return URL
- Default success webhook URL

Saving changes writes one settings record to the managed MySQL database. Settings are loaded by the public checkout through `GET /api/config/public` and persist across server restarts and deployment.

The CMS API is:

```http
GET /api/admin/settings
PUT /api/admin/settings
Authorization: Bearer ADMIN_API_KEY
```

The public endpoint intentionally omits the private default webhook URL:

```http
GET /api/config/public
```

Do not place HitPay credentials in the CMS. HitPay secrets belong in protected project environment variables.

## Gateway API authentication

The reusable gateway API is protected by `GATEWAY_API_KEY`. Connected backends must send:

```http
Authorization: Bearer YOUR_GATEWAY_API_KEY
```

The API key must remain on the connected backend or serverless function. Do not expose it in browser JavaScript, mobile app bundles, public repositories, or frontend environment variables.

## Create a payment request

```http
POST /api/v1/payment-requests
Authorization: Bearer YOUR_GATEWAY_API_KEY
Content-Type: application/json
```

Example:

```bash
curl -X POST https://YOUR-GATEWAY-DOMAIN/api/v1/payment-requests \
  -H "Authorization: Bearer YOUR_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "25.00",
    "currency": "SGD",
    "name": "Jane Customer",
    "email": "jane@example.com",
    "purpose": "Order 1001",
    "reference_number": "ORDER-1001",
    "redirect_url": "https://your-site.com/payment-complete",
    "webhook_url": "https://your-site.com/api/payment-webhook"
  }'
```

Required fields are `amount`, `currency`, `name`, and `email`. `purpose`, `reference_number`, `redirect_url`, and `webhook_url` are optional. The configured CMS default currency is used when `currency` is omitted by the hosted checkout, but API callers should send it explicitly.

The gateway returns a response like:

```json
{
  "ok": true,
  "payment": {
    "reference": "ORDER-1001",
    "status": "pending",
    "amount": "25.00",
    "currency": "SGD",
    "checkout_url": "https://YOUR-GATEWAY-DOMAIN/...",
    "mode": "mock"
  }
}
```

Redirect the customer’s browser to `payment.checkout_url`. Do not construct or guess the checkout URL yourself.

There is also a browser-oriented route used by the hosted checkout:

```http
POST /api/create-payment
Content-Type: application/json
```

Custom websites should use the authenticated `/api/v1/payment-requests` route from their backend instead.

## Query payment status

```http
GET /api/v1/payment-requests/ORDER-1001
Authorization: Bearer YOUR_GATEWAY_API_KEY
```

The customer-facing return page uses the unauthenticated status helper:

```http
GET /api/payment-status?reference=ORDER-1001
```

Treat a payment as paid only after a confirmed webhook or a trusted server-side status check. Do not fulfill an order only because a customer visited the redirect URL.

## Custom success notifications

Include `webhook_url` in the payment request to receive a gateway notification after success. The URL must use HTTPS in live mode. Mock mode also permits localhost URLs for local testing.

The gateway sends:

```http
POST https://your-site.com/api/payment-webhook
Content-Type: application/json
X-Gateway-Event: payment.succeeded
X-Gateway-Signature: HMAC_SHA256_SIGNATURE
```

Example event:

```json
{
  "id": "evt_example",
  "type": "payment.succeeded",
  "created_at": "2026-11-25T00:00:00.000Z",
  "data": {
    "payment": {
      "reference": "ORDER-1001",
      "status": "completed",
      "amount": "25.00",
      "currency": "SGD"
    }
  }
}
```

The signature is an HMAC-SHA256 digest of the raw request body using `GATEWAY_WEBHOOK_SECRET`:

```js
const expected = crypto
  .createHmac('sha256', process.env.GATEWAY_WEBHOOK_SECRET)
  .update(rawRequestBody)
  .digest('hex');
```

Compare the received `X-Gateway-Signature` using a constant-time comparison. Return a 2xx response only after validating and processing the event. Make your webhook handler idempotent because delivery may be retried by a future delivery worker or manually replayed.

The gateway records the last delivery result in the payment record as `webhook_delivery`, including the HTTP status or error.

## Environment variables

| Variable | Required | Function |
| --- | --- | --- |
| `GATEWAY_MODE` | No | `mock` by default; use `live` for HitPay forwarding |
| `GATEWAY_API_KEY` | Yes for protected API | Bearer key used by connected backends |
| `ADMIN_API_KEY` | Yes for CMS | Bearer key used by `/admin` and admin settings API |
| `GATEWAY_WEBHOOK_SECRET` | Yes for production notifications | Signs custom `payment.succeeded` events |
| `DATABASE_URL` | Supplied by managed database | MySQL connection used for CMS settings |
| `HITPAY_API_KEY` | Live mode only | HitPay Business API key |
| `HITPAY_SALT` | Live mode only | HitPay webhook signing salt |
| `HITPAY_ENV` | Live mode only | `sandbox` or `production` |
| `HITPAY_API_BASE_URL` | No | Optional HitPay API base override |
| `CORS_ORIGIN` | No | Restricts allowed browser origins; default is `*` |

Never commit values for these variables to Git. Use the project’s protected secret input for private values.

## Mock mode test

Mock mode is the recommended first integration step:

```text
GATEWAY_MODE=mock
```

Create a payment using the API or open `/` in Preview. The response contains a `/mock-checkout.html` URL. Open it and select **Simulate successful payment**. The gateway marks the payment `completed`, sends the custom success webhook if one was configured, and redirects to the payment result page.

For local notification testing, create a payment with a localhost webhook URL:

```json
{
  "amount": "5.00",
  "currency": "SGD",
  "name": "Webhook Test",
  "email": "test@example.com",
  "webhook_url": "http://127.0.0.1:39123/notify"
}
```

Localhost webhook URLs are accepted only in mock mode. Public or production webhook URLs must use HTTPS.

## HitPay Sandbox test

Use separate HitPay Sandbox credentials. Never mix a Sandbox API key or salt with Production mode.

Set protected values:

```text
HITPAY_API_KEY=<HitPay sandbox Business API key>
HITPAY_SALT=<HitPay sandbox webhook salt>
```

Set the gateway environment:

```text
GATEWAY_MODE=live
HITPAY_ENV=sandbox
```

The gateway uses the HitPay sandbox API base:

```text
https://api.sandbox.hit-pay.com/v1
```

In the HitPay Sandbox dashboard, register the public gateway endpoint:

```text
https://YOUR-GATEWAY-DOMAIN/api/webhooks/hitpay
```

Subscribe to the `payment_request.completed` event. The gateway checks the `Hitpay-Signature` header against the raw request body using the Sandbox `HITPAY_SALT`.

Create a small sandbox payment:

```bash
curl -X POST https://YOUR-GATEWAY-DOMAIN/api/v1/payment-requests \
  -H "Authorization: Bearer YOUR_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "5.00",
    "currency": "SGD",
    "name": "Sandbox Customer",
    "email": "sandbox@example.com",
    "purpose": "Sandbox checkout test",
    "reference_number": "SANDBOX-001",
    "webhook_url": "https://your-site.com/api/payment-webhook"
  }'
```

Open the returned `checkout_url` and complete the transaction using the sandbox payment method or test credentials provided by HitPay for your account. No real money should move in Sandbox. If HitPay requires a specific sandbox setup, follow the payment-method instructions shown in the HitPay Sandbox dashboard.

Verify all of the following:

1. The checkout opens and accepts the sandbox test payment.
2. The gateway receives `payment_request.completed`.
3. The HitPay signature validates successfully.
4. The gateway status becomes `completed`.
5. The custom `payment.succeeded` webhook is delivered, if configured.
6. The connected application fulfills the order only once.
7. Cancelled, abandoned, invalid, and failed payment paths do not fulfill the order.

Query status after the test:

```bash
curl https://YOUR-GATEWAY-DOMAIN/api/v1/payment-requests/SANDBOX-001 \
  -H "Authorization: Bearer YOUR_GATEWAY_API_KEY"
```

## Production cutover

Before switching to Production, confirm the complete Sandbox flow and make sure your connected site handles duplicate notifications safely.

Replace the Sandbox credentials with matching Production credentials:

```text
HITPAY_API_KEY=<HitPay production Business API key>
HITPAY_SALT=<HitPay production webhook salt>
GATEWAY_MODE=live
HITPAY_ENV=production
```

The production base URL is:

```text
https://api.hit-pay.com/v1
```

Register the production webhook separately:

```text
https://YOUR-GATEWAY-DOMAIN/api/webhooks/hitpay
```

Use the Production HitPay dashboard and Production salt. Do not reuse the Sandbox salt. After deployment, perform one small controlled real transaction and verify the gateway status, HitPay webhook, custom webhook, and connected order handling.

## Security checklist

Keep `GATEWAY_API_KEY`, `ADMIN_API_KEY`, `GATEWAY_WEBHOOK_SECRET`, `HITPAY_API_KEY`, and `HITPAY_SALT` in protected project secrets. Do not put them in frontend JavaScript, the CMS database, README examples, Git, screenshots, or customer-visible URLs.

Use HTTPS for production redirect and webhook URLs. Restrict `CORS_ORIGIN` when the calling websites are known. Validate payment amount, currency, reference, and email on the server. Verify webhook signatures using the raw request body and constant-time comparison. Use idempotency in the connected order system. Keep fulfillment logic in the connected backend, not in the customer redirect page.

## Troubleshooting

**Unauthorized API response**: check the `Authorization: Bearer ...` header and confirm the caller is using the configured `GATEWAY_API_KEY`, not the admin key.

**CMS says admin authorization is required**: open `/admin`, enter the configured `ADMIN_API_KEY`, and make sure the key is configured in the environment used by the running Preview or deployment.

**CMS changes disappear**: confirm the managed database is enabled and that `DATABASE_URL` is available to the server. The CMS uses the `gateway_settings` table.

**HitPay invalid business API key**: make sure `HITPAY_ENV` matches the credential environment. A Sandbox key fails against Production and a Production key fails against Sandbox.

**HitPay webhook signature mismatch**: validate the raw JSON body, use the salt from the same HitPay environment, and read the exact `Hitpay-Signature` header.

**Custom webhook not delivered**: use a public HTTPS URL, return a 2xx response, inspect `webhook_delivery`, and check that the URL is not blocked by a firewall or authentication layer.

**Payment appears pending**: do not mark it paid from the redirect. Check HitPay webhook delivery and query the gateway status using the server-side API key.

## Local development

The project uses Node.js and pnpm:

```bash
pnpm install
GATEWAY_MODE=mock node server.js
```

The managed Webdev runtime starts the project on port 3000. The committed `Dockerfile` is used for server deployment. The project uses `mysql2` to persist CMS settings in the managed MySQL database.

## Official HitPay reference

HitPay’s online payments guide describes the server-side payment-request flow, hosted checkout redirect, webhook registration, and signature validation:

<https://docs.hitpayapp.com/apis/guide/online-payments>
