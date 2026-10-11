package dev.protocolia;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;
@SpringBootApplication
@RestController
public class RenderProbeApplication {
 public static void main(String[] args) { SpringApplication.run(RenderProbeApplication.class, args); }
 @GetMapping("/health")
 public Map<String,Object> health() { return Map.of("status","P4_RENDER_PROBE_ONLY","agent_generated",false,"verified_trial",false); }
}
