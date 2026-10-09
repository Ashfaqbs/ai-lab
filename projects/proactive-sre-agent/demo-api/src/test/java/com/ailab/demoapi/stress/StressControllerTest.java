package com.ailab.demoapi.stress;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(StressController.class)
class StressControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private StressService stressService;

    @Test
    void shouldReturn202WhenCpuStressAccepted() throws Exception {
        mockMvc.perform(post("/api/stress/cpu").param("seconds", "1"))
                .andExpect(status().isAccepted());
    }

    @Test
    void shouldReturn400WhenCpuSecondsInvalid() throws Exception {
        doThrow(new StressRequestValidationException("seconds must be positive"))
                .when(stressService).startCpuStress(anyInt());

        mockMvc.perform(post("/api/stress/cpu").param("seconds", "0"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldReturn202WhenMemoryStressAccepted() throws Exception {
        mockMvc.perform(post("/api/stress/memory").param("mb", "10"))
                .andExpect(status().isAccepted());
    }

    @Test
    void shouldReturn200OnReset() throws Exception {
        mockMvc.perform(post("/api/stress/reset"))
                .andExpect(status().isOk());
    }

    @Test
    void shouldReturn202WhenDbHoldAccepted() throws Exception {
        mockMvc.perform(post("/api/stress/db-hold")
                        .param("connections", "2")
                        .param("seconds", "1"))
                .andExpect(status().isAccepted());
    }
}
