# Design System

## Overview

Restrained, dark, terminal-native product UI for prolonged analytical work. The interface favors aligned numeric columns, thin rules, compact controls, and one electric teal interaction accent.

## Color

Use only OKLCH tokens. Near-black blue-cast backgrounds create three restrained elevation levels. Teal denotes interaction and active state; green, amber, and red are reserved for trend and system status. Never rely on hue alone.

## Typography

Inter is used for labels, titles, controls, and prose. IBM Plex Mono is used for counts, velocities, timestamps, IDs, quota, and tabular values. Data remains compact; headings use weight and spacing rather than display scale.

## Layout

A persistent top command bar sits over a responsive monitoring grid: one column at 375px, two on medium screens, three on wide screens. Detail mode uses a 40/60 split and collapses to one column below desktop widths. Spacing follows a 4px base scale.

## Components

Data surfaces use square 1px borders and radii no larger than 3px. Buttons and form controls share consistent hover, focus, active, disabled, loading, and error states. Status uses a dot or compact badge plus text. Tables have no rounded containers.

## Motion

Only state transitions move: count updates, modal/panel entry, and trend-color changes. Timings are 150 to 280ms except the 1200ms count interpolation. Reduced-motion mode makes all transitions immediate.
