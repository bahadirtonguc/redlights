import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ViewMode = "overview" | "focused";

interface UiState {
  mode: ViewMode;
  selectedSignalId: string | null;
  aboutOpen: boolean;
}

const initialState: UiState = {
  mode: "overview",
  selectedSignalId: null,
  aboutOpen: false,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    selectSignal(state, action: PayloadAction<string>) {
      state.selectedSignalId = action.payload;
      state.mode = "focused";
    },
    clearSelection(state) {
      state.selectedSignalId = null;
      state.mode = "overview";
    },
    toggleAbout(state) {
      state.aboutOpen = !state.aboutOpen;
    },
  },
});

export const { selectSignal, clearSelection, toggleAbout } = uiSlice.actions;
export default uiSlice.reducer;
