/** Log diagnostic fields only, never request/response objects or credentials. */
export function errorDetails(error: unknown): { name: string; message: string; cause?: string } {
	if (!(error instanceof Error)) return { name: 'UnknownError', message: 'Non-Error failure' };
	return {
		name: error.name,
		message: error.message.slice(0, 500),
		...(error.cause instanceof Error ? { cause: error.cause.message.slice(0, 500) } : {}),
	};
}
