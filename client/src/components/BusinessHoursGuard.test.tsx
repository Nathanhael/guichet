import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BusinessHoursGuard from './BusinessHoursGuard';
import useStore from '../store/useStore';

describe('BusinessHoursGuard Component', () => {
  beforeEach(() => {
    useStore.getState().setSelectedLang('en');
  });

  it('renders children when business hours are open', () => {
    useStore.getState().setBusinessHoursOpen(true);
    
    render(
      <BusinessHoursGuard>
        <div data-testid="child">Protected Content</div>
      </BusinessHoursGuard>
    );
    
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.queryByText(/Chat is currently closed/i)).not.toBeInTheDocument();
  });

  it('renders closed message when business hours are closed', () => {
    useStore.getState().setBusinessHoursOpen(false);
    
    render(
      <BusinessHoursGuard>
        <div data-testid="child">Protected Content</div>
      </BusinessHoursGuard>
    );
    
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.getByText(/Chat is currently closed/i)).toBeInTheDocument();
  });
});
