# Slack DM/Thread Architecture Note

## Why channel-per-chat is wrong for this product

The product requirement is per-user privacy inside a shared customer workspace:

- Alice must see only Alice chats.
- Bob must see only Bob chats.

A channel-per-chat model (especially public channels) violates this:

- creates workspace-visible chat artifacts,
- increases membership-management complexity,
- does not map to Slack’s natural app UX for personal assistant interactions.

## Correct model for v1

1. Install Slack app once per workspace (`slack_workspace_installations`).
2. Link each app user to their Slack identity (`slack_user_links`).
3. Open one bot↔user DM per linked user.
4. Represent each app chat as a thread in that DM (`chats.slack_thread_ts`).

## Privacy implications

- Transport boundary is private DM, not workspace-shared channel.
- Data boundary is app ownership (`chats.owner_user_id`) enforced in:
  - API queries,
  - RLS policies,
  - realtime subscription authorization.

This yields isolated Alice/Bob sync behavior within the same Slack workspace.
