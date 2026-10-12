# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately on GitHub, with this repository's
[private report form](https://github.com/Talk2View/talk2view-typescript/security/advisories/new).
It is also the **Report a vulnerability** button on the **Security and quality**
tab. The report stays private unless we publish an advisory about it. Our
maintainers can read it, and so can anyone we bring in to help fix the problem.

The form needs a GitHub account. If you do not have one, or would rather not
use GitHub, use the contact form at
[talk2view.com/resources/contact](https://talk2view.com/resources/contact)
instead, and start the subject with "Security". The message box holds 2,000
characters and takes no files, so send a summary and we will reply by email
for the rest.

Tell us what you found, how to reproduce it, and what an attacker could do with
it. We aim to confirm receipt within five business days. We will tell you what
we intend to do, and credit you when it is fixed unless you would rather we did
not.

## What this package is, and what it is not

This SDK runs in an end-user's browser, inside a partner's application. Two
things follow from that, and they shape what counts as a vulnerability here.

**The partner key is public.** `pk_live_…` identifies an application, not a
person, and it is meant to ship in a browser bundle — the way a Stripe
publishable key or a Firebase config does. Finding one in a page's JavaScript is
not a vulnerability. Every request that reaches data also carries an end-user
token, and that token is what authorises anything.

**The end-user's token is the thing worth protecting.** It is held in
`localStorage` under a `talk2view_` prefix, with an in-memory fallback when the
browser refuses storage. Anything that lets a third party read it, replay it,
or obtain one for somebody else is a vulnerability, and we want to hear about
it. That includes the popup sign-in flow, cross-tab behaviour, and anything
rendered from a model's reply.

## Patient data

Talk2View is not a medical device and is not for diagnosis or treatment. Do not
send protected health information (PHI) or other patient-identifiable data
through the SDK: what end-users send, and what a partner's tools return, goes to
third-party AI providers, and Talk2View has no safeguard that detects, redacts
or blocks it. The [Terms of Use](https://talk2view.com/legal/terms-of-use) and
the [Privacy Policy](https://talk2view.com/legal/privacy-policy) say this in
full.

## Supported versions

The latest published minor receives security fixes. Older minors do not.

## Scope

In scope: this package's source and what it publishes to npm.

Out of scope: the Talk2View engine's own endpoints, which are not in this
repository (report those through the
[report form in Talk2View/docs](https://github.com/Talk2View/docs/security/advisories/new)
or the contact form), and anything that requires an attacker to already control
the page the SDK is running in — a script on the host page can read anything the
page can, and no client library can prevent that.
