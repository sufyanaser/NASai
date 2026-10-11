# UI/UX Standards

## Primary workflow

The home screen must answer three questions immediately: what workspace is active, what task should run, and what safety state applies.

## Rules

- Show one dominant task composer; secondary actions must not compete with it.
- Ask only for input the user needs to provide; infer or inspect the rest.
- Display workspace scope and approval state before execution.
- Keep evidence and task history accessible without filling the primary screen.
- Use explicit empty, loading, success, failure, and unavailable states.
- Keyboard focus, semantic controls, and readable contrast are acceptance criteria.
- RTL is a deliberate layout mode, not only right-aligned text.

The current screen is a visual and architectural foundation. Buttons without an implemented engine must not claim task execution.
