package dev.protocolia.domain;

import org.springframework.stereotype.Service;
import dev.protocolia.upstream.api.DefaultApiDelegate;
import dev.protocolia.upstream.model.Health;

@Service
public final class HealthDelegate implements DefaultApiDelegate {
    @Override
    public Health health() { return new Health().status("UP"); }
}
