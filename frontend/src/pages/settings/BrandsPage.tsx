import MasterDataListPage from '../../components/common/MasterDataListPage';
import { brandsApi } from '../../services/masterData';

export default function BrandsPage() {
  return (
    <MasterDataListPage
      title="Brands"
      singularLabel="Brand"
      queryKey="brands"
      apiList={brandsApi.list}
      apiCreate={brandsApi.create}
      apiUpdate={brandsApi.update}
      apiDelete={brandsApi.delete}
    />
  );
}
