export const UNANSWERED_CALLS_OPTIONS = [
  'לא ענה פעם 1',
  'לא ענה פעם 2',
  'לא ענה פעם 3',
  'לא ענה פעם 4',
  'לא ענה פעם 5',
] as const

type UnansweredCallsOption = (typeof UNANSWERED_CALLS_OPTIONS)[number]

const UNANSWERED_CALLS_INDEX = new Map<string, number>(
  UNANSWERED_CALLS_OPTIONS.map((option, index) => [option, index])
)

export const getNextUnansweredCallsCount = (
  currentValue: string | null | undefined
): UnansweredCallsOption => {
  const currentIndex = currentValue ? UNANSWERED_CALLS_INDEX.get(currentValue) ?? -1 : -1
  const nextIndex = Math.min(currentIndex + 1, UNANSWERED_CALLS_OPTIONS.length - 1)
  return UNANSWERED_CALLS_OPTIONS[nextIndex]
}

export const isMaxUnansweredCallsCount = (currentValue: string | null | undefined) =>
  currentValue === UNANSWERED_CALLS_OPTIONS[UNANSWERED_CALLS_OPTIONS.length - 1]
