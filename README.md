# content_loading_placeholder
An HTML div that aims to reveal content after an event with different styles

**[▶ Live Demo](https://awqxkawerbxo.github.io/content_loading_placeholder/)**

## Usage

Add `data-clp` to any `<div>` and include the CSS and JS files:

```html
<link rel="stylesheet" href="content-loading-placeholder.css" />

<div
  data-clp
  data-duration="3"
  data-start-event="onload"
  data-headline="Loading…"
  data-placeholder="Please wait…|Almost there…|"
>
  <!-- content shown after loading -->
</div>

<script src="content-loading-placeholder.js"></script>
```

## Supported `data-*` attributes

| Attribute | Description |
|---|---|
| `data-duration` | Animation + minimum wait duration in seconds (default: 3) |
| `data-headline` | Headline text shown during loading |
| `data-placeholder` | Pipe-separated texts cycled during loading |
| `data-content-url` | URL to fetch real content from |
| `data-content-trusted` | Set to `"true"` to inject fetched content as HTML (default: plain text) |
| `data-start-event` | `"onload"` or `"viewport"` (default: `"viewport"`) |
