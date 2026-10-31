## Reviewer bridge

When `PI_BRIDGE=1`, use `ask_reviewer(question, options?, default?, timeout_s?)` for a real decision the brief
and operating rules do not settle (for example an ownership conflict or an ambiguous acceptance boundary).
Never ask for routine confirmations, permission to follow the brief, or a progress acknowledgement. State the
tradeoff, offer concrete options, and give a safe default when possible. The default timeout is 15 minutes;
a timeout is reported explicitly. Continue with that default unless a hard rule requires stopping.

A message prefixed `[Reviewer bridge question #N]` is a live question: answer briefly in your next assistant
text and then continue the original task. It is not a request to abandon your brief or wait for confirmation.
Fork questions run in a separate no-tools session and do not require action in this instance.
