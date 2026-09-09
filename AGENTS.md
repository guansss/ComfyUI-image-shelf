# AGENTS Instructions

## Development

- Always activate Python venv before running any Python code.
- Always cd into the `ui` folder or use command line arguments (if applicable) to point to the `ui` folder when running commands related to the frontend.
- **Do not** access any external images without the user's explicit request. Prefer to use the images in `tests/assets` or craft a simple image if needed for testing. If accessing external images is necessary, ask the user for permission first.

## Testing

- Use `unittest` to run Python tests.
- Use `npm run test` to run frontend tests.
- To focus on one step, run test with filtering: `npm run test -- "<filename>"`.

## Communication

- Do not modify the codebase unless the user explicitly requests it. For example, "Why does...?" or "Do you think...?" should be interpreted as a discussion, not a request to change the code. If the discussion reveals a bug or an improvement, you may provide suggestions and ask the user for confirmation to make the change.
