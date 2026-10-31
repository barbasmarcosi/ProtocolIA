package dev.protocolia.modular;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Map;

public final class ProviderWebhookVerifierTest {
  private static final byte[] KEY=HexFormat.of().parseHex("11".repeat(32));
  private static final byte[] BODY=
    "{\"provider\":\"sandbox\",\"amount\":\"1.00\",\"event\":\"settled\"}"
      .getBytes(StandardCharsets.UTF_8);
  private static final String SIG=
    "v2=71033dfd23bc965cc8d17125539d8394d58e796bbb9deb7ea5a2c99f51732f6d";
  private static final long NOW=1793440000L;
  private static final String DIGEST=
    "20ece580daf2c31f7706a02043618938a28ea1fdf4041fabab1fc2f9558259eb";
  private static ProviderWebhookVerifier.Verified verify(String keyId,String ts,
      String eventId,String sig,byte[] body,Map<String,byte[]> keys,long now){
    return ProviderWebhookVerifier.verify("inbox",keyId,ts,eventId,sig,body,keys,now);
  }
  private static ProviderWebhookVerifier.Verified base(){
    return verify("sandbox_1","1793440000","evt_12345678",SIG,BODY,
      Map.of("sandbox_1",KEY),NOW);
  }
  private static void check(boolean ok,String message){
    if(!ok)throw new AssertionError(message);
  }
  public static void main(String[] args) {
    var accepted=base();
    check(accepted!=null,"valid raw-byte signature must verify");
    check(accepted.keyId().equals("sandbox_1"),"key identity");
    check(accepted.eventId().equals("evt_12345678"),"event identity");
    check(accepted.payloadSha256().equals(DIGEST),"cross-language SHA256");
    check(base()!=null,"authentication is stateless; persistence must prevent replay");
    for(String purpose:new String[]{"receipt-candidate","lifecycle-observation"})
      check(ProviderWebhookVerifier.verify(purpose,"sandbox_1","1793440000",
        "evt_12345678",SIG,BODY,Map.of("sandbox_1",KEY),NOW)==null,
        "inbox signature cannot authenticate "+purpose);
    byte[] tampered=BODY.clone();tampered[20]^=1;
    check(verify("sandbox_1","1793440000","evt_12345678",SIG,tampered,
      Map.of("sandbox_1",KEY),NOW)==null,"tampered body");
    check(verify("sandbox_1","1793440000","evt_99999999",SIG,BODY,
      Map.of("sandbox_1",KEY),NOW)==null,"tampered event");
    check(verify("sandbox_2","1793440000","evt_12345678",SIG,BODY,
      Map.of("sandbox_1",KEY),NOW)==null,"unknown key");
    check(verify("sandbox_1","1793440000","evt_12345678",SIG.toUpperCase(),BODY,
      Map.of("sandbox_1",KEY),NOW)==null,"noncanonical signature");
    check(verify("sandbox_1","1793440000","evt_12345678",SIG,BODY,
      Map.of("sandbox_1",KEY),NOW+301)==null,"stale");
    check(verify("sandbox_1","1793440000","evt_12345678",SIG,BODY,
      Map.of("sandbox_1",KEY),NOW-301)==null,"future");
    check(verify("sandbox_1","1793440000","evt_12345678",SIG,BODY,
      Map.of("sandbox_1",KEY),NOW+300)!=null,"window boundary");
    check(verify("sandbox_1","1793440000000","evt_12345678",SIG,BODY,
      Map.of("sandbox_1",KEY),NOW)==null,"milliseconds");
    check(verify("sandbox_1","1793440000","evt_bad\nline",SIG,BODY,
      Map.of("sandbox_1",KEY),NOW)==null,"newline event id");
    check(verify("sandbox_1","1793440000","evt_12345678",SIG,new byte[0],
      Map.of("sandbox_1",KEY),NOW)==null,"empty body");
    check(verify("sandbox_1","1793440000","evt_12345678",SIG,new byte[65537],
      Map.of("sandbox_1",KEY),NOW)==null,"oversized body");
    check(verify("sandbox_1","1793440000","evt_12345678",SIG,BODY,
      Map.of("sandbox_1",new byte[31]),NOW)==null,"weak key");
    check(verify("sandbox_1","1793440000","evt_12345678",SIG,BODY,
      Map.of("sandbox_1",KEY,"retired_1",new byte[32]),NOW)!=null,"key rotation");
    check(verify("sandbox_1","1793440000","evt_12345678",SIG,BODY,
      Map.of("sandbox_1",KEY,"a",KEY,"b",KEY,"c",KEY),NOW)==null,"unbounded keys");
    System.out.println("PROTOCOLIA_S2C1C0_JAVA_ENVELOPE_PASS");
  }
}
