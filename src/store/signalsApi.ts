import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { SignalsSnapshot } from "@/lib/model/types";

export const signalsApi = createApi({
  reducerPath: "signalsApi",
  baseQuery: fetchBaseQuery({ baseUrl: "/api/" }),
  endpoints: (builder) => ({
    getSignals: builder.query<SignalsSnapshot, { city?: string } | void>({
      query: (arg) => `signals${arg?.city ? `?city=${arg.city}` : ""}`,
    }),
  }),
});

export const { useGetSignalsQuery } = signalsApi;
