import {
	Card,
	Grade,
	Rating,
	createEmptyCard,
	fsrs,
	generatorParameters,
} from 'ts-fsrs';

export type ReviewRating = 1 | 3;
export type RatingIntervals = Record<ReviewRating, string>;
export type IntervalPreset = 'relaxed' | 'standard' | 'intensive' | 'exam';

/**
 * One scheduler instance is sufficient: FSRS is deterministic apart from the
 * requested interval fuzz, and it does not retain per-card mutable state.
 */
const schedulers: Record<IntervalPreset, ReturnType<typeof fsrs>> = {
	relaxed: fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.85, learning_steps: ['7d', '21d'], relearning_steps: ['5d'], maximum_interval: 36500 })),
	standard: fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9, learning_steps: ['3d', '7d'], relearning_steps: ['3d'], maximum_interval: 3650 })),
	intensive: fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.94, learning_steps: ['2d', '4d'], relearning_steps: ['2d'], maximum_interval: 730 })),
	exam: fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.97, learning_steps: ['1d', '3d'], relearning_steps: ['1d'], maximum_interval: 180 })),
};

export function initializeCard(reviewTime: Date = new Date()): Card {
	const now = new Date(reviewTime);
	const card = createEmptyCard(now);
	card.due = now;
	return card;
}

export function scheduleReview(
	card: Card,
	rating: ReviewRating,
	reviewTime: Date = new Date(),
	preset: IntervalPreset = 'standard',
): Card {
	assertRating(rating);
	return schedulers[preset].next(card, new Date(reviewTime), rating as Grade).card;
}

/** Returns compact previews for the two topic-review decisions. */
export function previewIntervals(
	card: Card,
	reviewTime: Date = new Date(),
	preset: IntervalPreset = 'standard',
): RatingIntervals {
	const now = new Date(reviewTime);
	const outcomes = schedulers[preset].repeat(card, now);

	return {
		1: formatInterval(outcomes[Rating.Again].card.due.getTime() - now.getTime()),
		3: formatInterval(outcomes[Rating.Good].card.due.getTime() - now.getTime()),
	};
}

export function isReviewRating(value: unknown): value is ReviewRating {
	return value === 1 || value === 3;
}

function assertRating(value: unknown): asserts value is ReviewRating {
	if (!isReviewRating(value)) {
		throw new Error(`Invalid FSRS rating: ${String(value)}`);
	}
}

function formatInterval(milliseconds: number): string {
	const minutes = Math.max(1, Math.round(milliseconds / 60_000));
	if (minutes < 60) return `${minutes}m`;

	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;

	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d`;
	if (days < 365) return `${Math.round(days / 30)}mo`;
	return `${(days / 365).toFixed(days < 730 ? 1 : 0)}y`;
}
