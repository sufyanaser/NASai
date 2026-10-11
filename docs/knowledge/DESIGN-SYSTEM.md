# NASai Design System

NASai uses one visual language across the desktop chrome and product UI. New screens must reuse these foundations instead of introducing one-off colors or interaction patterns.

## Foundations

- Canvas: `--color-canvas`
- Surfaces: `--color-surface`, `--color-surface-raised`, `--color-surface-soft`
- Borders: `--color-border`, `--color-border-strong`
- Text: `--color-text`, `--color-text-muted`, `--color-text-subtle`
- Accent: `--color-accent`, `--color-accent-strong`, `--color-accent-soft`
- Danger: `--color-danger`, `--color-danger-soft`
- Focus: `--focus-ring`
- Radius scale: `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-lg`
- Elevation: `--shadow-card`

## Interaction contract

- Every actionable control needs visible hover, active, focus-visible, and disabled states.
- Success, warning, and error colors must carry a label or icon; color cannot be the only signal.
- Scrollbars, selection, window controls, menus, notifications, prompts, buttons, and badges use the same dark-teal token family.
- Motion communicates state changes only. Respect `prefers-reduced-motion`.
- The mascot reports the same state as the workflow and never claims success before verification.

## Desktop chrome

The Windows title bar is part of the product surface. It uses the NASai canvas, border, typography, and mascot mark. Window controls remain familiar and expose accessible labels while minimize, maximize, and close are handled through the isolated preload bridge.

## Component patterns

- Primary command: mint fill, dark label, restrained glow.
- Secondary command: bordered dark surface with a brighter hover border.
- Status badge: compact semantic label with matching border and soft background.
- Card: one-pixel border, 16px radius, subtle elevation.
- Input: dark inset surface; the complete field receives the common focus ring.
- Alert or notification: icon plus title and supporting text; reserve red for actionable failure.
