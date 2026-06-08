/**
 * Client helper for the GET /api/autorun/folder-events SSE endpoint.
 * Subscribes to file-system changes inside an Auto Run Docs folder.
 */

export interface FolderFileEvent {
	path: string;
	type: 'add' | 'change' | 'unlink';
}

/**
 * Watch an Auto Run Docs folder for changes via SSE.
 * Returns a cleanup function that closes the EventSource.
 */
export function watchAutorunFolder(
	folder: string,
	serverToken: string,
	onEvent: (event: FolderFileEvent) => void,
	onError?: (err: Event) => void
): () => void {
	const url = `/${serverToken}/api/autorun/folder-events?path=${encodeURIComponent(folder)}`;
	const es = new EventSource(url);

	es.addEventListener('file-changed', (e: MessageEvent) => {
		try {
			onEvent(JSON.parse(e.data) as FolderFileEvent);
		} catch {
			/* ignore malformed frames */
		}
	});

	if (onError) {
		es.onerror = onError;
	}

	return () => es.close();
}
