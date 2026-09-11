import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

interface UiState {
  selectedSignalId: string | null;
  aboutOpen: boolean;
}

const initialState: UiState = {
  selectedSignalId: null,
  aboutOpen: false,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    selectSignal(state, action: PayloadAction<string>) {
      state.selectedSignalId = action.payload;
    },
    clearSelection(state) {
      state.selectedSignalId = null;
    },
    toggleAbout(state) {
      state.aboutOpen = !state.aboutOpen;
    },
  },
});

export const { selectSignal, clearSelection, toggleAbout } = uiSlice.actions;
export default uiSlice.reducer;
