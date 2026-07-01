# Design

## Style

数据密集型金融产品界面。默认深色主题，强调策略市场、榜单、订单和后台管理的可读性。视觉密度可以偏高，但布局必须稳定、表格清晰、状态颜色一致。

## Color Tokens

```css
:root {
  --bg: oklch(0.10 0.015 255);
  --surface: oklch(0.16 0.018 255);
  --surface-2: oklch(0.21 0.020 255);
  --ink: oklch(0.96 0.006 255);
  --muted: oklch(0.72 0.018 255);
  --primary: oklch(0.70 0.13 78);
  --primary-ink: oklch(0.12 0.015 255);
  --accent: oklch(0.65 0.11 170);
  --success: oklch(0.70 0.14 150);
  --warning: oklch(0.76 0.15 76);
  --danger: oklch(0.64 0.18 28);
  --border: oklch(0.30 0.022 255);
}
```

## Typography

Use a system sans stack for Chinese and English UI: `Inter, "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`. Use tabular numbers for prices, balances,成交量 and table values.

## Layout

Desktop uses an app shell: fixed top bar, left navigation, main workspace. Mobile collapses navigation into horizontal tabs. Cards are used for strategy items and repeated records only; management surfaces use tables and panels.

## Components

Buttons, segmented filters, badges, tables, forms, modals, toasts, empty states, KPI tiles, strategy cards, comment list, upload image placeholders and admin review rows.

## Motion

Keep transitions between 150ms and 220ms. Use motion for state changes only: selected nav, modal open, toast, card hover and tab switching. Respect `prefers-reduced-motion`.
