<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { X } from 'lucide-svelte';
  import type { Snippet } from 'svelte';
  let { open = $bindable(false), title, description = '', children }: {
    open?: boolean; title: string; description?: string; children: Snippet;
  } = $props();

  const sheetId = $props.id();
  let content = $state<HTMLDivElement | null>(null);
  let body = $state<HTMLDivElement | null>(null);
  let expanded = $state(false);
  let dragging = $state(false);
  let dragHeight = $state<number | null>(null);
  let dragOffset = $state(0);
  let collapsedHeight = 0;
  let suppressClick = false;
  type Gesture = {
    pointerId: number;
    startY: number;
    startHeight: number;
    baseHeight: number;
    wasExpanded: boolean;
    lastY: number;
    lastTime: number;
    velocity: number;
    moved: boolean;
  };
  let gesture: Gesture | null = null;

  $effect(() => {
    gesture = null;
    dragging = false;
    if (open) {
      expanded = false;
      dragHeight = null;
      dragOffset = 0;
      collapsedHeight = 0;
      suppressClick = false;
    }
  });

  $effect(() => {
    // A new panel starts with its introduction/result visible. Resizing or
    // typing in the current panel must keep the existing scroll position.
    if (open && title && body) body.scrollTop = 0;
  });

  function focusOnOpen(event: Event) {
    event.preventDefault();
    const panel = content;
    if (!panel) return;
    requestAnimationFrame(() => {
      if (!open || content !== panel || !panel.isConnected) return;
      const active = panel.ownerDocument.activeElement;
      // The user may already be typing before the opening frame runs.
      // Keep that focus so Enter reaches the form instead of the resize handle.
      if (active !== panel && active && panel.contains(active)) return;
      panel.querySelector<HTMLButtonElement>('.sheet-drag-handle')?.focus({ preventScroll: true });
    });
  }

  function setExpanded(next: boolean) {
    if (!content) return;
    if (!expanded) collapsedHeight = content.getBoundingClientRect().height;
    expanded = next;
    dragHeight = null;
    dragOffset = 0;
  }

  function startDrag(event: PointerEvent) {
    if (!content || !event.isPrimary || event.button !== 0) return;
    const height = content.getBoundingClientRect().height;
    if (!expanded) collapsedHeight = height;
    gesture = {
      pointerId: event.pointerId, startY: event.clientY, startHeight: height,
      baseHeight: collapsedHeight || height, wasExpanded: expanded,
      lastY: event.clientY, lastTime: event.timeStamp, velocity: 0, moved: false
    };
    suppressClick = false;
    dragging = true;
    // Capture keeps the handle in control when the finger or mouse leaves it.
    (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const delta = event.clientY - gesture.startY;
    gesture.velocity = (event.clientY - gesture.lastY) / Math.max(16, event.timeStamp - gesture.lastTime);
    gesture.lastY = event.clientY;
    gesture.lastTime = event.timeStamp;
    gesture.moved ||= Math.abs(delta) > 5;
    const height = gesture.startHeight - delta;
    // Resize down to the natural content height, then move the entire sheet.
    dragHeight = Math.max(gesture.baseHeight, height);
    dragOffset = Math.max(0, gesture.baseHeight - height);
  }

  function releaseCapture(event: PointerEvent) {
    const handle = event.currentTarget as HTMLButtonElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }

  function finishDrag(event: PointerEvent) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const finished = gesture;
    const distance = event.clientY - finished.startY;
    const velocity = event.timeStamp - finished.lastTime < 100 ? finished.velocity : 0;
    const dismiss = dragOffset > Math.max(90, finished.baseHeight * 0.25)
      || (!finished.wasExpanded && dragOffset > 24 && distance > 40 && velocity > 0.65);
    suppressClick = finished.moved;
    gesture = null;
    dragging = false;
    releaseCapture(event);
    if (dismiss) {
      open = false;
      return;
    }
    expanded = distance < -40 ? true : distance > 40 ? false : finished.wasExpanded;
    dragHeight = null;
    dragOffset = 0;
  }

  function cancelDrag(event: PointerEvent) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    expanded = gesture.wasExpanded;
    suppressClick = gesture.moved;
    gesture = null;
    dragging = false;
    dragHeight = null;
    dragOffset = 0;
    releaseCapture(event);
  }

  function handleClick(event: MouseEvent) {
    // A browser may synthesize a click after a drag; it must not toggle again.
    if (suppressClick && event.detail !== 0) {
      suppressClick = false;
      return;
    }
    suppressClick = false;
    setExpanded(!expanded);
  }

  function handleKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setExpanded(event.key === 'ArrowUp');
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="sheet-overlay" />
    <Dialog.Content
      bind:ref={content}
      onOpenAutoFocus={focusOnOpen}
      class={`sheet-content${dragging ? ' sheet-dragging' : ''}`}
      style={`height: ${dragHeight !== null ? `${dragHeight}px` : expanded ? 'var(--sheet-max-height)' : 'auto'}; translate: 0 ${dragOffset}px;`}
    >
      <button
        type="button" class="sheet-drag-handle" aria-label="Resize panel"
        aria-expanded={expanded} aria-controls={`${sheetId}-body`}
        aria-describedby={`${sheetId}-drag-help`}
        onpointerdown={startDrag} onpointermove={moveDrag} onpointerup={finishDrag}
        onpointercancel={cancelDrag} onlostpointercapture={cancelDrag}
        onclick={handleClick} onkeydown={handleKey}
      ><span class="sheet-handle" aria-hidden="true"></span></button>
      <span id={`${sheetId}-drag-help`} class="sr-only">Drag up to expand, drag down to collapse or close. Use the arrow keys or press Enter to resize.</span>
      <div class="sheet-heading">
        <Dialog.Title class="sheet-title">{title}</Dialog.Title>
        <Dialog.Close class="icon-button" aria-label="Close dialog"><X size={23} /></Dialog.Close>
      </div>
      <Dialog.Description class={description ? 'sheet-description' : 'sr-only'}>{description || title}</Dialog.Description>
      <div bind:this={body} id={`${sheetId}-body`} class="sheet-body">{@render children()}</div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
