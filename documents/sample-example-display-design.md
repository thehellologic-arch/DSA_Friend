# Practice Sample Example Display

## Goal

Show one curated sample directly in the Core Ask card so the student has
concrete input and output before explaining an approach.

## Data Source

Use the first entry in `rubric.optimal.examples`. The LLM must not generate or
rewrite the sample.

The session creation response adds a required `sampleExample` object:

```ts
interface SampleExample {
  input: string;
  output: string;
  explanation: string;
}
```

All 76 current rubrics were checked and each contains three examples with
input, output, and explanation. The rubric schema will require at least one
non-empty example so future problems cannot omit this data.

## UI

Render the sample below the core question:

```text
EXAMPLE
Input: [100,4,200,1,3,2]
Output: 4
Explanation: The longest consecutive sequence is [1,2,3,4].
```

The block uses the existing dark card style with compact labels and wrapping
for long values. It remains readable on the current mobile-width layout.

## Testing

- Rubric parsing rejects missing, empty, or incomplete examples.
- Session creation returns the first curated sample.
- Practice screen renders input, output, and explanation.
- Existing tutor transcript and input behavior remain unchanged.

## Deployment

Run the unit tests and production build, commit the change, push `main`, deploy
the resulting commit to Render, and verify the live health and practice API.
