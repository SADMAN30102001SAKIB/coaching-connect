# SMS provider investigation

Investigated: 2026-10-22. Primary integration evidence: APIDocs.txt lines 1-175. No credential is reproduced here.

## Implemented conservative adapter

The user authorized building without waiting for support replies. The implementation uses personalized bulk POST (including one recipient), cached balance GET and known-ID status POST. Unknown acknowledgements/timeouts pause rather than auto-resend. Batch size defaults to one and pacing is configurable per center. Mock mode is entirely local; the undocumented provider sandbox is not presumed safe or called. No real key, live send or account-wide history API has been used or invented. All external behavior still needs the approved pilot described in the root README.

## Documented capability coverage

### Single send: APIDocs.txt 5-55

- GET /api/send-sms with API key, sender, destination and message; quick-send example also contains type=text.
- Node example inconsistently places JSON in a GET body. Standard Fetch does not support using that pattern.
- Product use: explicitly confirmed test message or individual notification. Prefer a confirmed supported body-based submission route; do not expose credentials/recipient text in browser URLs.
- If the provider only supports GET single-send, call it exclusively server-side with controlled logging. A one-recipient bulk POST is another candidate only after confirming minimum batch size and equivalent billing.

### Personalized bulk: APIDocs.txt 58-96

- POST /api/send-bulk-sms with api_key, senderid and MessageParameters containing Number/Text pairs.
- Product use: per-recipient rendered result/announcement campaigns, bounded by verified provider limits.
- Missing: success response, per-item IDs, partial failures, maximum size, rates, ordering guarantee, idempotency, and timeout recovery. Do not invent any of these.

### Balance and estimated count: APIDocs.txt 100-112

- GET /api/get-balance with query-string API key. Example returns a decimal-looking balance string and estimate_sms.
- Product use: separate cached balance per center/credential revision, manual refresh, pre-send check and low-balance handling.
- Balance is not a reservation, and estimate_sms does not establish Unicode/multipart cost for a selected campaign. Read/refresh requires distinct permissions; refresh is throttled and concurrent refresh requests coalesce through durable state.

### Delivery lookup: APIDocs.txt 118-169

- /api/sms-check, documented GET and POST, keyed by API key and MessageId. Prefer confirmed POST without a query credential.
- Example contains ErrorCode/ErrorDescription and Data with number, sender, text, timestamps, ID, Status and nested ErrorCode.
- Product use: reconcile known messages belonging to that center; show provider-reported delivery, submission and unresolved outcomes separately.
- No account-wide list, date-range history query, bulk status query, callback signature, or webhook registration is documented. Local history is authoritative for sends initiated by this app; dashboard sends made elsewhere are not automatically visible.
- The example Status combines a phone string with Delivered. Parse only verified formats; preserve a safe normalized unknown outcome for unexpected values. Timestamp timezone is undocumented.

### Sandbox: APIDocs.txt 3-4

- A separate base URL is supplied, but route construction, credentials, fake recipient requirements and non-billing guarantee are absent.
- Do not guess that appending production endpoint names is correct or that a sandbox send cannot reach a real phone. Obtain instructions before calls.

### Sender selection and errors: APIDocs.txt 10-24, 171-175

- Documentation recommends multiple approved sender IDs, but says an approved 11-digit sender while examples show differing lengths. No fixed sender-length rule can be safely inferred.
- Configure provider-approved values per center; send one initial attempt with its chosen sender. Do not rotate and resend after uncertain acceptance.
- Documented application codes: 202 means submitted and 1007 means low balance. Delivery sample uses top-level 0 for lookup success. Do not conflate HTTP 202, submission code 202 and delivery success.
- OTP wording is advice, not a separate endpoint; auth SMS is explicitly out of scope.

## Public-source checks

- [Provider product page](https://www.onecodesoft.com/bulk-sms) advertises Bangla Unicode and two-way messaging. Neither a multipart billing algorithm nor an inbound webhook/API contract is supplied in the local document.
- The same page contains conflicting package rates and MNP surcharge presentation. Treat it as marketing, not a signed account tariff or machine-readable contract. Do not hardcode those prices.
- Two-way messages, recharge/payment automation and marketing-dashboard features are not automatically integration features. Add them only if separately requested and documented; no inbound SMS implementation in this scope.
- Browser retrieval could not access the supplied API base. A credential-free GET to https://sms.ocs-api.top/api/ returned 404. This does not prove the service is down or endpoint methods are invalid.

## Questions to send to provider support

This questionnaire has not been sent. The user/operator must contact support or supply complete account documentation.

1. Supply exact single/bulk success and failure response examples with HTTP status and body types. How does every recipient map to its message ID? Can one request partly succeed?
2. What are the maximum items, bytes and message length per call, requests per second and account concurrency limits? Does throttling always mean nothing was accepted? Is Retry-After provided?
3. Are idempotency keys/client references supported? How long are they retained? Can we search by client reference after a timeout before a provider ID was returned?
4. What are the correct body-based single-send and sms-check methods? Are GET bodies required anywhere? Are authentication headers supported instead of query-string keys?
5. Provide complete submission/delivery error/status enumerations, terminal states, lookup delays, data retention, timestamp timezone and missing-ID behavior.
6. Is there a signed delivery webhook or a bulk status endpoint? If so, provide authentication/signature, replay and retry documentation. Do not build a webhook on an assumed contract.
7. Precisely how do sandbox paths/credentials work, and are delivery and charges disabled? Supply safe test numbers and deterministic partial-failure examples.
8. Confirm GSM-7 extension characters, Unicode/Bangla/emoji handling, multipart capacities, concatenation, line breaks, truncation/rejection, maximum segments and per-segment billing.
9. Confirm currency, tax, MNP charges, masking differences, refunds/rejections, account-specific rates, balance freshness and estimate_sms meaning.
10. Which sender IDs belong to each account? Validate format/length, rotation rules, masking approval and whether bulk requests use one sender for every entry.
11. Can keys be rotated/revoked, restricted by scope/host/IP, and used concurrently? Does a new key retain access to messages created with an old key? Cloudflare outbound IP restrictions require explicit compatibility confirmation.
12. Does the provider support only Bangladesh destinations? Are there current consent, suppression, sending-hour or service restrictions applicable to educational results?

## Validation sequence after answers

1. Convert documented responses into redacted fixture contracts, clearly labeled as documentation-derived until actually observed.
2. With approved sandbox credentials and proven non-billing semantics, verify single/bulk, partial rejection, encoding, balance and status lookup. Do not log keys, message bodies or full destinations.
3. Verify Worker Fetch compatibility, bounded response sizes, timeouts and code normalization in the real runtime.
4. Only after explicit approval, send a tiny live pilot to named consenting test recipients; compare message IDs, received content, delivery reports and before/after balance.
5. If safe bulk mapping is unavailable, fail the bulk integration gate. Do not silently turn a campaign into thousands of individual calls or infer delivery.
6. If provider idempotency is absent, retain manual resolution for ambiguous submissions. This is a real reliability boundary, not something a queue or database can eliminate.

## Credential issue before GitHub

APIDocs.txt contains an apparent API key. It was not used. Ask the account owner to rotate it if genuine, then authorize sanitizing the original file before staging/publishing. Existing documentation is left unchanged in this planning turn. A private repository is not a secret store.
