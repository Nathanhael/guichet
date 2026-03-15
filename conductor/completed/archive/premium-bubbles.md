# Implementation Plan: Identity-Enhanced & Premium Chat Bubbles

## Objective
Transform the chat experience into a professional, enterprise-grade interface by adding user identifiers (Avatars), sequential message grouping, and Solaris-themed visual refinements.

---

## 1. Identity & Avatars (Azure Ready)

### **New Component: `UserAvatar.tsx`**
- **Logic**: 
  - If `avatarUrl` exists -> Show Image.
  - Else -> Show **Initials** (e.g., "JD" for John Doe).
- **Branding**: Background color generated from a hash of the `userId` to ensure consistency.
- **Support Ring**: Add a subtle border using `var(--brand-primary)` for users with `support` or `admin` roles.
- **Status Dot**: Integration with the new distributed presence (Online/Away/Busy).

---

## 2. Professional Chat Logic

### **Sequential Grouping**
- Update the rendering loop in `ChatWindow.tsx` to detect messages from the same sender within a short window (e.g., 2 minutes).
- **Impact**: 
  - Only the *first* message in a group shows the Avatar and Sender Name.
  - Middle messages lose their "Bubble Tail" and have reduced vertical spacing.
  - The *last* message shows the timestamp.

### **Sentiment & AI Visuals**
- **Sentiment Glow**: Add a 1px border glow to bubbles based on the `sentiment` score:
  - Red glow for negative (score < -0.4).
  - Green/Teal glow for positive (score > 0.4).
- **AI Tooltip**: Replace the "Show Original" button with a small ✨ icon. Hovering shows the original text in a glassmorphic tooltip.

---

## 3. Premium Solaris Aesthetics

### **Theming Refresh**
- **`isMine`**: Transition from a solid color to a **Mesh Gradient** using `var(--brand-primary)` and `var(--brand-secondary)`.
- **`isOthers`**: Enhance the glass effect with `backdrop-blur-xl` and higher saturation.
- **Animations**: Use `AnimatePresence` for smooth entry/exit of avatars during grouping transitions.

---

## 4. Technical Requirements

### 4.1 Database & Types
- [ ] **Schema**: Add `avatar_url` (text) to the `users` table.
- [ ] **Types**: Update `User`, `Membership`, and `Message` interfaces in `client/src/types/index.ts`.

### 4.2 Component Refactor
- [ ] **`UserAvatar.tsx`**: Create the new avatar component.
- [ ] **`MessageBubble.tsx`**: 
  - Update layout to handle left/right avatars.
  - Implement grouping props (`isGroupStart`, `isGroupEnd`).
  - Apply new gradient and glass styles.
- [ ] **`ChatWindow.tsx`**: Implement the grouping algorithm before mapping messages.

---

## 5. Phased Implementation Plan

### **Phase 1: Foundation (Identities)**
- [ ] Update DB Schema and Types for `avatarUrl`.
- [ ] Create `UserAvatar.tsx`.
- [ ] Integrate a static Avatar into `MessageBubble` (without grouping yet).

### **Phase 2: Logic (Grouping)**
- [ ] Implement the grouping logic in `ChatWindow.tsx`.
- [ ] Adjust `MessageBubble` CSS to hide tails/names for sequential messages.

### **Phase 3: Visuals (Premium Polish)**
- [ ] Implement Mesh Gradients for own messages.
- [ ] Add Sentiment Glow and Sparkle hover effects.
- [ ] Final Solaris design pass.
