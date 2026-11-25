# TODO

- [x] Mobile-first hosted checkout page at `/`.
- [x] Reusable authenticated `POST /api/v1/payment-requests` API.
- [x] Authenticated status API at `GET /api/v1/payment-requests/:reference`.
- [x] Mock mode for integration testing without HitPay credentials.
- [x] HitPay live-mode adapter and signed webhook validation.
- [x] Developer docs at `/docs`.
- [x] Optional signed `payment.succeeded` notification webhook per payment.
- [x] Protected CMS admin dashboard at `/admin` using `ADMIN_API_KEY`.
- [x] Persistent MySQL-backed gateway settings for branding, copy, colors, currencies, and payment defaults.
- [ ] Set a production `GATEWAY_API_KEY`.
- [ ] Add HitPay credentials and set `GATEWAY_MODE=live` before real payments.
- [ ] Register the deployed `/api/webhooks/hitpay` URL in HitPay.
