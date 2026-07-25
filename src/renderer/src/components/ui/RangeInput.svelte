<script>
  import { clampNumber, formatRangeValue, setRangeValue } from '../../lib/rangeInput.js'

  /**
   * @type {{
   *   value?: number,
   *   min?: number,
   *   max?: number,
   *   step?: number,
   *   decimals?: number,
   *   disabled?: boolean,
   *   className?: string,
   *   rangeClassName?: string,
   *   inputClassName?: string,
   *   oninput?: (value: number) => void
   * }}
   */
  let {
    value = $bindable(0),
    min = 0,
    max = 1,
    step = 0.01,
    decimals = undefined,
    disabled = false,
    className = '',
    rangeClassName = 'flex-1 accent-blue-500',
    inputClassName = 'w-14',
    oninput
  } = $props()

  const precision = $derived(
    decimals ?? (step >= 1 ? 0 : (String(step).split('.')[1]?.length ?? 2))
  )

  let editing = $state(false)
  let draft = $state('')

  /** @param {number | string} raw */
  function commit(raw) {
    const next = clampNumber(raw, min, max, step)
    value = next
    oninput?.(next)
  }

  function onRangeInput(/** @type {Event} */ e) {
    commit(/** @type {HTMLInputElement} */ (e.currentTarget).value)
  }

  function onNumberFocus() {
    editing = true
    draft = formatRangeValue(value, precision)
  }

  function onNumberInput(/** @type {Event} */ e) {
    const el = /** @type {HTMLInputElement} */ (e.currentTarget)
    draft = el.value

    const trimmed = el.value.trim()
    if (trimmed === '' || trimmed === '-' || trimmed.endsWith('.')) return

    const num = Number(trimmed)
    if (!Number.isFinite(num)) return

    commit(trimmed)
    if (editing) draft = formatRangeValue(value, precision)
  }

  function onNumberBlur() {
    editing = false
    commit(draft)
  }

  function onNumberChange(/** @type {Event} */ e) {
    const el = /** @type {HTMLInputElement} */ (e.currentTarget)
    draft = el.value
    commit(el.value)
    if (editing) draft = formatRangeValue(value, precision)
  }

  /** @param {KeyboardEvent} e */
  function onNumberKeydown(e) {
    if (e.key === 'Enter') {
      e.currentTarget instanceof HTMLInputElement && e.currentTarget.blur()
    }
  }
</script>

<div class="flex min-w-0 flex-1 items-center gap-1.5 {className}">
  <input
    type="range"
    class="min-w-0 {rangeClassName} {disabled ? 'opacity-50' : ''}"
    {min}
    {max}
    {step}
    {disabled}
    use:setRangeValue={value}
    oninput={onRangeInput}
  />
  <input
    type="number"
    class="field-input shrink-0 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums {inputClassName} {disabled
      ? 'opacity-50'
      : ''}"
    {min}
    {max}
    {step}
    {disabled}
    value={editing ? draft : formatRangeValue(value, precision)}
    onfocus={onNumberFocus}
    oninput={onNumberInput}
    onchange={onNumberChange}
    onblur={onNumberBlur}
    onkeydown={onNumberKeydown}
  />
</div>
