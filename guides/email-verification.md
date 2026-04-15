# Email in Knowledge Management

Three flows send you email today: verifying your address, resetting your password, and receiving a workspace invite.

## Verifying your email

When you sign up we send a message with a verification link. Open the link once and your account is marked verified. Until then a banner at the top of the app asks you to verify, and a small number of actions (triggering a vault export, changing your password) are disabled.

If the email does not arrive, use the "Resend email" button in the banner. For your protection we accept at most three sends per address in any ten-minute window. If you hit the limit, wait a few minutes before trying again.

The link is valid for 24 hours. If you need a fresh one after it expires, use the resend button.

## Resetting a forgotten password

From the login screen pick "Forgot password?" and enter your email address. We always show the same confirmation screen whether or not the address is known, to avoid leaking which addresses are registered.

If your address is registered you will receive a link valid for one hour. Opening the link takes you to a page where you can choose a new password. After setting the new password you are redirected to the login page to sign in.

If the link has expired, go back to the login screen and request another reset.

## Workspace invites

When a workspace owner or admin invites you, you receive an email containing an accept link. Opening the link while signed in adds you to the workspace with the role the inviter assigned. If you are not signed in you will be asked to sign in or create an account first, and then the invite is applied.

Invites do not require you to have verified your email address before you can accept.

## Troubleshooting

**I never received the email.** Check your spam or junk folder. If it is not there, use the resend button (for verification) or request a new reset link (for password reset). If you are using a corporate email address, ask your IT team whether external mail from Microsoft Graph is being filtered.

**The link says it has expired.** Verification links are valid for 24 hours and reset links for one hour. Request a fresh one using the resend or forgot-password flow.

**The link says it has already been used.** Each link can only be used once. If you believe you have not used it, someone else with access to your mailbox may have opened it. Contact your workspace administrator.

**I am getting too many verification emails.** The system enforces a limit of three sends per ten-minute window. If you are receiving more than that, contact support.
