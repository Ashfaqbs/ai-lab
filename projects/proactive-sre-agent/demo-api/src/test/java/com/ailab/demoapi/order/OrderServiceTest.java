package com.ailab.demoapi.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

    @Mock
    private OrderRepository orderRepository;

    @Test
    void shouldReturnOrderWhenIdExists() {
        Order order = new Order("Ashfaq", "widget", 2);
        when(orderRepository.findById(any())).thenReturn(Optional.of(order));

        OrderService service = new OrderService(orderRepository);
        OrderResponse response = service.get(UUID.randomUUID());

        assertThat(response.customerName()).isEqualTo("Ashfaq");
        assertThat(response.quantity()).isEqualTo(2);
    }

    @Test
    void shouldThrowWhenIdDoesNotExist() {
        when(orderRepository.findById(any())).thenReturn(Optional.empty());
        OrderService service = new OrderService(orderRepository);
        UUID missing = UUID.randomUUID();

        assertThatThrownBy(() -> service.get(missing))
                .isInstanceOf(OrderNotFoundException.class);
    }

    @Test
    void shouldSaveAndReturnOrderOnCreate() {
        when(orderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        OrderService service = new OrderService(orderRepository);

        OrderResponse response = service.create(new OrderRequest("Ashfaq", "widget", 3));

        assertThat(response.item()).isEqualTo("widget");
        assertThat(response.quantity()).isEqualTo(3);
    }
}
