/** HTTP-shaped errors let the UI exercise the same failure paths as a real API. */
export class MockApiError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'invalid_request'
  ) {
    super(message);
    this.name = 'MockApiError';
  }
}

export function invalid(message: string): never {
  throw new MockApiError(message);
}

export function missing(message: string): never {
  throw new MockApiError(message, 404, 'not_found');
}
