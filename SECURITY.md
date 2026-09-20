# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it through [talk2view.com/contact](https://talk2view.com/contact), or
privately on GitHub through **Security → Report a vulnerability** on this
repository. Tell us what you found, how to reproduce it, and what an attacker
could do with it. We will confirm receipt, tell you what we intend to do, and
credit you when it is fixed unless you would rather we did not.

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

## Supported versions

The latest published minor receives security fixes. Older minors do not.

## Scope

In scope: this package's source and what it publishes to npm.

Out of scope: the Talk2View engine's own endpoints (report those the same way,
but they are not in this repository), and anything that requires an attacker to
already control the page the SDK is running in — a script on the host page can
read anything the page can, and no client library can prevent that.
