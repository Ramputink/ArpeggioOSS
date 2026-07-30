# Archive

Prototypes that did their job and were superseded. They are kept because each
one answered a question, and the answer is easier to re-read than to re-derive —
but nothing builds them, nothing tests them, and they are not expected to run.

|           | What it was for                                                                                                                           | Superseded by                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `viewer/` | The first proof that the canonical `Score` model could be rendered and played back at all: a piano-roll with a cursor, hands and a synth. | `apps/learn`, which draws real notation from the same model. |
| `mockup/` | A static design sketch of the iPhone app — six screens, light and dark — used to settle the layout before any of it existed.              | The app itself.                                              |

The two live apps are:

- **`apps/learn`** — the learner PWA. This is the product.
- **`apps/web`** — the lab: OMR import, the MOTOR 2 bench, and anything that
  needs a desktop browser and a backend.
