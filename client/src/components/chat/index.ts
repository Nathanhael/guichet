// Public chat surface. Bundle C slice 3 (#78): per-fragment exports
// (AttachmentGrid / DeliveryStatus / QuoteBlock / LinkPreviewCard /
// MessageContent) removed from this barrel — they are now private
// internals reachable only through `<Message>`. The files survive on
// disk so the React.lazy import targets in MessageContent.tsx stay
// stable, but they cannot be imported via this barrel.
export { default as ImageLightbox } from './ImageLightbox';
export { default as ChatHeader } from './ChatHeader';
export { default as Message } from './Message';
export type { MessageProps } from './Message';
export { default as MessageList } from './MessageList';
export { default as ComposeArea } from './ComposeArea';
export type { ComposeAreaHandle } from './ComposeArea';
export { default as SearchBar } from './SearchBar';
export { default as FormatToolbar } from './FormatToolbar';
