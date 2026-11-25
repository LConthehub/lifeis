# Goal progress bar: notes for the owner

This is the bar under every goal (Goals page, a plan, a holiday, a trip, a project). It is flat on purpose: no art, no gradients. You can design it later. The code is in frontend/src/components/Goals.jsx (GoalProgress). The words under it come from core/src/goalFigures.ts (progressOf) and are always shown.

## States

| State | Words under the bar | Bar color now | What the bar shows |
|---|---|---|---|
| On track | $120 of $400, on track | blue-brown | Set aside, out of the goal |
| Behind | $120 of $400, behind by $40 | amber | Set aside, out of the goal |
| Over | $415 of $400, over by $15 | red | Spent from the goal, out of the goal |
| Done | $400 of $400, done | green | Full |

- Behind means less is set aside than an even pace to the goal's day. The month's ask goes up and the budget says so.
- Over means more was spent (tagged to the plan) than the goal.
- A goal with no day is always on track until it is done.
- Whole dollars show without cents ($120); otherwise cents show ($12.50).

## Sizes

- Bar: full width of its card, 8 px tall, square ends.
- Words: 14 px, under the bar, 4 px gap.
- Works at 375 px wide. The words wrap; the bar never scrolls sideways.
- The bar is a progressbar for screen readers, with the percent in its label. The words are the real message, so color is never the only sign.

## To decide

- Whether Over should fill past the end, or show a second mark.
- Whether Behind should show where the even pace is (a tick mark).
- Rounded ends, height, and the colors.
