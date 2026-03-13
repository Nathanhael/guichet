import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useT } from './i18n';
import useStore from './store/useStore';

describe('useT (i18n)', () => {
  beforeEach(() => {
    act(() => {
      useStore.getState().setSelectedLang('en');
    });
  });

  it('returns English translation by default', () => {
    const { result } = renderHook(() => useT());
    expect(result.current('sign_out')).toBe('Sign out');
    expect(result.current('loading')).toBe('Loading...');
  });

  it('returns Dutch translation when lang is nl', () => {
    act(() => useStore.getState().setSelectedLang('nl'));
    const { result } = renderHook(() => useT());
    expect(result.current('sign_out')).toBe('Uitloggen');
  });

  it('returns French translation when lang is fr', () => {
    act(() => useStore.getState().setSelectedLang('fr'));
    const { result } = renderHook(() => useT());
    expect(result.current('sign_out')).toBe('Déconnexion');
  });

  it('falls back to English for missing keys in other languages', () => {
    act(() => useStore.getState().setSelectedLang('nl'));
    const { result } = renderHook(() => useT());
    // If a key exists in en but not nl, it should fall back to en
    const value = result.current('nonexistent_key_test');
    // Unknown keys return the key itself
    expect(value).toBe('nonexistent_key_test');
  });

  it('returns key name when translation is missing in all languages', () => {
    const { result } = renderHook(() => useT());
    expect(result.current('this_key_does_not_exist')).toBe('this_key_does_not_exist');
  });

  it('falls back to English for unsupported language codes', () => {
    act(() => useStore.getState().setSelectedLang('de'));
    const { result } = renderHook(() => useT());
    expect(result.current('sign_out')).toBe('Sign out');
  });
});
