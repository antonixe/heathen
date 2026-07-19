// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import Dashboard from './Dashboard.jsx'

const now = Date.now()

const makeVideo = (overrides = {}) => ({
  id: 1,
  videoId: 'abcdefghijk',
  status: 'active',
  addedAt: now - 60 * 60 * 1000,
  title: 'Launch single',
  channelName: 'Test Channel',
  pollState: 'idle',
  pollInterval: 60,
  lastPolledAt: now - 60 * 1000,
  lastViewCount: 12000,
  firstViewCount: 10000,
  sessionGain: 2000,
  velocity5m: 12,
  velocity30m: 10,
  tags: [],
  ...overrides,
})

const noop = () => {}

function renderDashboard(props = {}) {
  return render(
    <TooltipProvider>
      <Dashboard
        videos={[]}
        filter="all"
        searchQuery=""
        onFilterChange={noop}
        calibration={null}
        onAdd={noop}
        onOpen={noop}
        onCompare={noop}
        {...props}
      />
    </TooltipProvider>,
  )
}

describe('Dashboard', () => {
  it('shows the empty workbench and routes the track action', () => {
    const onAdd = vi.fn()
    renderDashboard({ onAdd })
    expect(screen.getByText('No releases on the rundown')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /track release/i }))
    expect(onAdd).toHaveBeenCalledOnce()
  })

  it('renders one row per tracked release with summary counts', () => {
    const videos = [
      makeVideo(),
      makeVideo({ id: 2, videoId: 'lmnopqrstuv', title: 'Second drop', lastPolledAt: now - 45 * 60 * 1000 }),
    ]
    renderDashboard({ videos })
    expect(screen.getByText('Launch single')).toBeTruthy()
    expect(screen.getByText('Second drop')).toBeTruthy()
    const summary = within(screen.getByLabelText('Rundown summary'))
    expect(summary.getByText('Tracked').nextSibling.textContent).toBe('2')
    expect(within(screen.getByRole('tab', { name: /^All/ })).getByText('2')).toBeTruthy()
    expect(within(screen.getByRole('tab', { name: /^Stale/ })).getByText('1')).toBeTruthy()
  })

  it('filters the register by release state', () => {
    const onFilterChange = vi.fn()
    const videos = [
      makeVideo(),
      makeVideo({ id: 2, videoId: 'lmnopqrstuv', title: 'Second drop', lastPolledAt: now - 45 * 60 * 1000 }),
    ]
    const view = renderDashboard({ videos, onFilterChange })
    fireEvent.click(screen.getByRole('tab', { name: /^Stale/ }))
    expect(onFilterChange).toHaveBeenCalledWith('stale')

    view.rerender(
      <TooltipProvider>
        <Dashboard videos={videos} filter="stale" searchQuery="" onFilterChange={onFilterChange} calibration={null} onAdd={noop} onOpen={noop} onCompare={noop} />
      </TooltipProvider>,
    )
    expect(screen.getByText('Second drop')).toBeTruthy()
    expect(screen.queryByText('Launch single')).toBeNull()
  })

  it('explains an empty search result instead of showing a blank board', () => {
    renderDashboard({ videos: [makeVideo()], searchQuery: 'zzz no match' })
    expect(screen.getByText('No releases match "zzz no match".')).toBeTruthy()
    expect(screen.queryByText('Launch single')).toBeNull()
  })

  it('surfaces error rows with a retry recovery action', () => {
    const videos = [makeVideo({ pollState: 'error', errorMessage: 'HTTP 500' })]
    renderDashboard({ videos, filter: 'attention' })
    expect(screen.getAllByText('Polling error').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('opens a release when its row is clicked', () => {
    const onOpen = vi.fn()
    renderDashboard({ videos: [makeVideo()], onOpen })
    fireEvent.click(screen.getByRole('button', { name: 'Launch single' }))
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onOpen.mock.calls[0][0].videoId).toBe('abcdefghijk')
  })
})
