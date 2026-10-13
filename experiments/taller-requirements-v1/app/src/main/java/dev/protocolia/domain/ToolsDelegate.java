package dev.protocolia.domain;

import java.util.List;
import org.springframework.stereotype.Service;
import dev.protocolia.upstream.api.ToolsApiDelegate;
import dev.protocolia.upstream.model.Tool;
import dev.protocolia.upstream.model.ToolPage;
import dev.protocolia.upstream.model.ToolRequest;
import dev.protocolia.upstream.model.ToolNameChange;
import dev.protocolia.upstream.model.QuantityAdjustment;

/** Handwritten bridge: endpoint and DTO contracts are owned by OpenAPI Generator. */
@Service
public final class ToolsDelegate implements ToolsApiDelegate {
  private final ToolInventory inventory;
  public ToolsDelegate(ToolInventory inventory){this.inventory=inventory;}
  private static Tool dto(ToolInventory.Entry row){
    return new Tool().code(row.code()).name(row.name()).quantity(row.quantity())
        .lastReviewedAt(row.lastReviewedAt());
  }
  @Override public Tool createTool(ToolRequest body){
    return dto(inventory.create(body==null?null:body.getCode(),
       body==null?null:body.getName(),body==null?null:body.getQuantity(),
       body==null?null:body.getLastReviewedAt()));
  }
  @Override public Tool getTool(String code){return dto(inventory.get(code));}
  @Override public Tool increaseQuantity(String code,QuantityAdjustment body){
    return dto(inventory.increase(code,body==null?null:body.getAmount()));
  }
  @Override public Tool renameTool(String code,ToolNameChange body){
    return dto(inventory.rename(code,body==null?null:body.getName()));
  }
  @Override public ToolPage listTools(Integer limit,Integer offset){
    var page=inventory.list(limit,offset);
    List<Tool> rows=page.items().stream().map(ToolsDelegate::dto).toList();
    return new ToolPage().items(rows).limit(page.limit()).offset(page.offset()).total(page.total());
  }
}
