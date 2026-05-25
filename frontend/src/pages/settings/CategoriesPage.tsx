import MasterDataListPage from '../../components/common/MasterDataListPage';
import { categoriesApi } from '../../services/masterData';

export default function CategoriesPage() {
  return (
    <MasterDataListPage
      title="Categories"
      singularLabel="Category"
      queryKey="categories"
      apiList={categoriesApi.list}
      apiCreate={categoriesApi.create}
      apiUpdate={categoriesApi.update}
      apiDelete={categoriesApi.delete}
    />
  );
}
