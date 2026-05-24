import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PosState {
  isFullscreen: boolean;
  shiftId: string | null;
  shiftOpenedAt: string | null; // ISO string — safe for JSON serialization
  enterPOS: () => void;
  exitPOS: () => void;
  openShift: (id: string) => void;
  closeShift: () => void;
}

export const usePosStore = create<PosState>()(
  persist(
    (set) => ({
      isFullscreen: false,
      shiftId: null,
      shiftOpenedAt: null,
      enterPOS:   () => set({ isFullscreen: true }),
      exitPOS:    () => set({ isFullscreen: false }),
      openShift:  (id: string) => set({ shiftId: id, shiftOpenedAt: new Date().toISOString() }),
      closeShift: () => set({ shiftId: null, shiftOpenedAt: null }),
    }),
    {
      name: 'erp_pos_shift',
      // Only persist shift data — isFullscreen resets on every page load
      partialize: (state) => ({
        shiftId:       state.shiftId,
        shiftOpenedAt: state.shiftOpenedAt,
      }),
    },
  ),
);
