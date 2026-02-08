# SOCIAL — Design System Documentation

## Overview

SOCIAL features an award-winning Swiss design aesthetic that emphasizes minimalism, precision, and functionality. The design system is built around the geometric diagonal lines of the brand logo, creating a cohesive visual language throughout the application.

## Design Principles

### Swiss Design Philosophy
1. **Minimalism** — Clean, uncluttered interfaces with purpose for every element
2. **Grid-Based Layouts** — 8px grid system for mathematical precision
3. **Typography First** — Clear hierarchy using Inter font (Swiss-style sans-serif)
4. **High Contrast** — Predominantly black and white for maximum readability
5. **Functional Beauty** — Form follows function with elegant simplicity
6. **Negative Space** — Strategic use of whitespace for visual breathing room

## Visual Identity

### Logo
The diagonal lines pattern represents:
- **Security** — Layered protection
- **Communication** — Flowing information
- **Precision** — Swiss engineering excellence

### Color Palette

```css
Primary: #000000 (Black)
Background: #FFFFFF (White)
Gray Scale: #fafafa → #171717 (9 shades)
Accent: #0070f3 (Blue, for interactive elements)
```

### Typography

**Font Family:** Inter
- Display: 48px - 96px (Bold/Medium)
- Headings: 24px - 48px (Medium)
- Body: 16px (Regular)
- Small: 14px - 12px (Regular/Medium)

**Font Weights:**
- Regular (400) — Body text
- Medium (500) — Headings, buttons
- Semibold (600) — Emphasis

### Spacing System

8px grid-based spacing:
```
1 unit = 8px
2 units = 16px
3 units = 24px
4 units = 32px
6 units = 48px
8 units = 64px
```

## Components

### Navigation
- Fixed top navigation with backdrop blur
- Animated active tab indicator
- Responsive icon + text layout
- Logo + brand name on left
- Navigation links on right

### Buttons
Three variants:
- **Primary:** Black background, white text
- **Secondary:** White background, black border and text
- **Ghost:** Transparent with hover state

Sizes: sm (12px), md (16px), lg (20px)

All buttons feature:
- Micro-interactions (scale on hover/tap)
- Loading state with animated spinner
- Disabled state with 40% opacity
- Focus-visible outline for accessibility

### Cards
- White background with subtle border
- Hover effect: lift + shadow
- Consistent padding (24px - 32px)
- Responsive layouts

### Diagonal Pattern
- Background element matching logo
- Subtle opacity (3%)
- Animated fade-in on page load
- Fixed position, non-interactive

## Animations

### Timing Functions
```css
Fast: 150ms cubic-bezier(0.4, 0, 0.2, 1)
Base: 200ms cubic-bezier(0.4, 0, 0.2, 1)
Slow: 300ms cubic-bezier(0.4, 0, 0.2, 1)
```

### Page Transitions
- Fade in: Opacity 0 → 1
- Slide up: Y offset 20px → 0
- Scale in: Scale 0.95 → 1

### Micro-interactions
- Button hover: Scale 1.02, translate Y -1px
- Button tap: Scale 0.98
- Card hover: Translate Y -2px, enhanced shadow
- Tab indicator: Spring animation (380 stiffness, 30 damping)

## Responsive Design

### Breakpoints
```css
sm: 640px   — Small tablets
md: 768px   — Tablets
lg: 1024px  — Laptops
xl: 1280px  — Desktops
```

### Mobile-First Approach
- Stacked layouts on mobile
- Horizontal layouts on tablet+
- Icon-only navigation on mobile
- Icon + text on tablet+

### Container Sizes
- sm: 768px
- md: 896px
- lg: 1024px (default)
- xl: 1400px

## Accessibility

### Focus States
- 2px outline offset by 2px
- Black outline color
- Applied to all interactive elements

### Color Contrast
- Black on white: 21:1 (AAA)
- Gray text: Minimum 4.5:1 (AA)

### Screen Readers
- Semantic HTML elements
- ARIA labels where needed
- Keyboard navigation support

### Motion
- Respects prefers-reduced-motion
- All animations can be disabled
- No flashing content

## Technical Implementation

### Stack
- **Framework:** Next.js 16 (React 19)
- **Styling:** Tailwind CSS 4
- **Animation:** Framer Motion 12
- **Icons:** Lucide React
- **Font:** Inter (Google Fonts)
- **State:** Zustand

### File Structure
```
app/
  ├── page.tsx          — Home page
  ├── login/page.tsx    — Identity setup
  ├── chat/page.tsx     — Messaging interface
  ├── settings/page.tsx — User settings
  └── globals.css       — Design system tokens

components/
  ├── DiagonalPattern.tsx — Background pattern
  ├── Logo.tsx            — Animated brand logo
  ├── Navigation.tsx      — Top navigation bar
  ├── Button.tsx          — Button component
  ├── Card.tsx            — Card container
  └── Container.tsx       — Layout container
```

### CSS Custom Properties
All design tokens are defined as CSS custom properties in `globals.css` for easy theming and maintenance.

## Usage Guidelines

### Do's
✓ Use 8px grid spacing
✓ Maintain high contrast
✓ Keep animations subtle
✓ Use semantic HTML
✓ Follow component patterns
✓ Test on mobile devices
✓ Validate accessibility

### Don'ts
✗ Add unnecessary colors
✗ Use arbitrary spacing
✗ Create one-off components
✗ Ignore responsive design
✗ Skip hover/focus states
✗ Use pixel-perfect positioning
✗ Break the grid system

## Performance

### Optimization
- Inter font with `display: swap`
- Framer Motion uses GPU acceleration
- Lazy loading for images
- Code splitting with Next.js
- Minimized animation JavaScript

### Loading Strategy
1. Font loads asynchronously
2. Hero content renders first
3. Below-fold content fades in
4. Background pattern last

## Future Enhancements

- [ ] Dark mode support
- [ ] Advanced animations for page transitions
- [ ] Custom icon set matching brand style
- [ ] Motion design system documentation
- [ ] Component Storybook
- [ ] Design tokens in JSON format
- [ ] Automated accessibility testing

---

**Design crafted with Swiss precision for modern web applications.**
