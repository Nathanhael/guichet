# Implementation Plan — Solaris UI/UX Refinement (Item 4) [COMPLETED]

This plan focuses on polishing the **Solaris Design System** to enhance aesthetic quality, improve neuro-inclusive focus, and provide a smoother, more interactive user experience using Framer Motion and refined CSS.

## Objective
*   Fine-tune glassmorphism for optimal readability and depth.
*   Implement smooth layout transitions for a "liquid" UI feel.
*   Introduce **Focus Mode (Zen Mode)** to reduce cognitive load for Experts.
*   Add micro-interactions and refined loading states.

## Proposed Changes

### 1. Refined Glassmorphism (`client/src/index.css`)
*   **Variable-based Opacity**: Use CSS variables for glass opacity to allow dynamic adjustment.
*   **Contrast Optimization**: Adjust `backdrop-blur` and `saturate` filters to ensure text remains legible on complex backgrounds.
*   **Border Glow**: Add subtle "inner glow" effects to `.glass-card` and `.glass-panel` using `box-shadow: inset`.

### 2. Smooth Motion (`Framer Motion`)
*   **Chat Bubble Entry**: Use `AnimatePresence` so bubbles slide/fade into view rather than popping.
*   **View Transitions**: Implement `layoutId` transitions when switching between Active Cockpit tabs or sidebar sections.
*   **Modal Refinement**: Update `RatingModal` and `FeedbackModal` with soft elastic spring animations.

### 3. Focus Mode (Zen Mode)
*   **Store Integration**: Add `focusMode: boolean` to `useStore.ts`.
*   **UI Implementation (`ExpertView.tsx`)**: 
    *   When enabled, auto-hide the sidebar (collapsible).
    *   Dim non-active chat windows in split-view.
    *   Hide queue position and non-essential navigation elements.
*   **Toggle**: Add a "Zen" icon button to the `NeuroToggle` or Navigation bar.

### 4. Micro-interactions & Polish
*   **Haptic Feedback (Visual)**: Add subtle "press" animations to all primary buttons.
*   **Loading Skeletons**: Replace the "Loading..." text in `AdminStats` and `AdminArchive` with themed glassmorphic skeletons.
*   **Sound Design (Optional)**: Implement a very soft, toggleable "pop" sound for outgoing messages.

## Phased Approach
1.  **Style Refinement**: Update `index.css` and `DashboardHelpers.tsx`.
2.  **Focus Mode**: Implement the store state and basic collapsible sidebar in `ExpertView`.
3.  **Motion Update**: Wrap `MessageBubble` and `ChatWindow` lists in Framer Motion components.
4.  **Skeleton Screens**: Update tRPC `isLoading` states with skeleton components.

## Verification
*   **Visual Regression**: Ensure light/dark modes still look correct with the new glass variables.
*   **Accessibility**: Test High Contrast mode to ensure refinements don't degrade the high-visibility alternative.
*   **Performance**: Verify that Framer Motion animations don't impact the frame rate on lower-end devices (ensure `layout` is used sparingly).
