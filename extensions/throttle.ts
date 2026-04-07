/**
 * Leading + trailing edge throttle.
 *
 * - First call fires immediately (leading edge).
 * - During cooldown, further calls just update the pending value.
 * - When cooldown expires, if a pending value exists, it fires (trailing edge)
 *   and starts a new cooldown.
 * - The callback always receives the latest value, never a stale one.
 */
export function throttle<T>(fn: (value: T) => void, cooldownMs: number): {
	(value: T): void;
	cancel: () => void;
	flush: () => void;
} {
	let lastFired = 0;
	let pending: { value: T } | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function fire(): void {
		if (timer) { clearTimeout(timer); timer = null; }
		if (!pending) return;
		const { value } = pending;
		pending = null;
		lastFired = Date.now();
		fn(value);
	}

	function throttled(value: T): void {
		pending = { value };
		const now = Date.now();
		if (now - lastFired >= cooldownMs) {
			fire();
		} else if (!timer) {
			timer = setTimeout(fire, cooldownMs - (now - lastFired));
		}
	}

	throttled.cancel = (): void => {
		if (timer) { clearTimeout(timer); timer = null; }
		pending = null;
	};

	throttled.flush = (): void => {
		fire();
	};

	return throttled;
}
