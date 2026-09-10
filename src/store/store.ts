import { configureStore } from "@reduxjs/toolkit";
import { signalsApi } from "./signalsApi";
import uiReducer from "./uiSlice";

export const store = configureStore({
  reducer: {
    ui: uiReducer,
    [signalsApi.reducerPath]: signalsApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(signalsApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
