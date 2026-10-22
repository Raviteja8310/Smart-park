# Phase 8 — Referral programme

## Scope

This phase adds unique personal referral codes, optional attribution during registration, a referral dashboard, and an internal referral-credit ledger. It reuses the existing account, booking, payment-verification, gate-exit, and audit systems.

## Qualification and rewards

- Each new account receives a cryptographically random `SP` referral code. Existing users receive a code when they first open **Refer & earn**.
- A new account can enter one referral code during registration. Unknown codes are rejected; attribution cannot be changed later through a public endpoint.
- A referral becomes qualified only after the referred account completes a parking session through the gate-exit workflow and the booking has a verified payment in `paid` state, with no refund in progress or completed for that booking.
- Qualification is transactionally recorded against one booking. A unique constraint prevents duplicate qualifying bookings, and a unique `(referral_id, beneficiary_user_id)` constraint prevents duplicate rewards.
- Both referrer and referred driver receive INR 100 in the `referral_rewards` ledger.
- These credits are internal ledger entries only. This phase does not implement cash payouts, wallet redemption, or applying credits to a future booking. They are not cash and are not withdrawable funds.

## Migration

Run `database/migrations/016_referral_program.sql` using the existing migration runner after taking a database backup. The migration creates `referral_codes`, `referrals`, and `referral_rewards`. It does not modify existing migration files.

## API

- `GET /api/referrals/me` — personal code, referral link, summary, referral history, and reward policy.
- `GET /api/referrals/rewards` — the signed-in user's reward ledger.
- Registration accepts an optional `referralCode` field.

## Validation checklist

1. Apply migrations on a disposable database and run API tests.
2. Open **Refer & earn** for an existing user; confirm a stable code is created.
3. Register a new account using a valid code and verify the attribution appears in the referrer's dashboard.
4. Verify an invalid code is rejected and the account is not partially created.
5. Complete a test booking with a verified paid payment and record a gate exit; confirm one referral qualifies and exactly two credits are recorded.
6. Replay the exit request and confirm no duplicate rewards are created.
7. Verify unpaid, cancelled, or refunded bookings do not qualify.

## Operational notes

Referral codes are attribution identifiers, not authentication secrets. Apply rate limits to registration, monitor abuse, and consider device/payment risk checks before enabling monetary redemption. Rewards are fixed at INR 100 each in this phase; changing the policy requires a reviewed code change and clear user-facing terms.
